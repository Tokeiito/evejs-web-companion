<script lang="ts">
  // The standings: the pilot's (the Character Sheet's Standings panel, charsheet/standingsPanel/standingsPanel.py,
  // toID the pilot) and its corporation's (the Corporation window's NPC Standings panel, the same panel toID the
  // corporation). Each lists the owners that stand toward it as the client's list does (ui/standingsList.ts): its
  // groups, each entry's picture and "<standing> <name>", its quick filter, and the sort the panels share
  // (standingsConst STANDING_SORT_SETTING, kept in this browser as the client keeps it among its settings).
  //
  // Not as the client's yet: the panel's right side (the selected owner's header, history, graph and the standings
  // bar) stands under the entry clicked; and the two panels are one window, not the Character Sheet's and the
  // Corporation window's.
  //
  // ⚠ empty vs failed. `char`/`corp` are null while unread OR when the read FAILED (reason in the matching *Error);
  // an empty list is the real answer.
  import { onMount } from "svelte";
  import { isSessionLost } from "../app/flow.ts";
  import { classifyStandingKind } from "../bridge/standings.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { CharStanding } from "../store/types.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import { showInfo, type InfoSubject } from "./showInfo.ts";
  import OwnerPicture from "./OwnerPicture.svelte";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { portraitDefaultPath, portraitUrl } from "./ownerImages.ts";
  import {
    DEFAULT_STANDINGS_SORT,
    STANDINGS_GROUP_LABELS,
    STANDINGS_SORTS,
    standingsListGroups,
    type StandingsListEntry,
    type StandingsSort,
  } from "./standingsList.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const standings = store.standings;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const skills = store.skills;
  // svelte-ignore state_referenced_locally
  const agents = store.agents;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const ownerLogos = flow.ownerLogos;
  // svelte-ignore state_referenced_locally
  const imageServer = flow.imageServer;
  // svelte-ignore state_referenced_locally
  const corporationFactions = flow.corporationFactions;

  let busy = $state(false);
  let error = $state("");

  async function run(action: () => Promise<void> | void): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        return;
      }
      error =
        panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  function refresh(): void {
    void run(() => flow.loadStandings());
  }

  /** The list's labels, with the page's own words where the install's are not had. */
  const STANDINGS_WORDS: Readonly<Record<string, string>> = {
    "UI/Common/Factions": "Factions",
    "UI/Common/Corporations": "Corporations",
    "UI/Common/Agents": "Agents",
    "UI/Agents/AgentEntryNameAndLevel": "{[character]ownerID.name}, level {level}",
    "UI/Standings/SortingHeader": "Order",
    "UI/Standings/DefaultFilter": "As kept",
    "UI/Standings/AscendingFilter": "Lowest first",
    "UI/Standings/DescendingFilter": "Highest first",
    "UI/Standings/NameFilter": "By name",
    "UI/Standings/RecentChangeFilter": "Latest changes",
    "UI/Common/SortBy": "Order",
    "UI/Standings/NoResultsFound": "Nothing to list.",
    "UI/Common/Search": "Find",
  };

  /** STANDING_SORT_SETTING: the sort both panels share, kept in this browser. */
  const SORT_SETTING_KEY = "standingsSortedBy";
  let sort = $state<StandingsSort>(DEFAULT_STANDINGS_SORT);
  let sortMenuOpen = $state(false);
  function chooseSort(value: StandingsSort): void {
    sort = value;
    sortMenuOpen = false;
    try {
      localStorage.setItem(SORT_SETTING_KEY, value);
    } catch {
      // Not kept: the setting stands for this window only.
    }
  }

  onMount(() => {
    refresh();
    try {
      const kept = localStorage.getItem(SORT_SETTING_KEY);
      const known = STANDINGS_SORTS.find((each) => each.value === kept);
      if (known) sort = known.value;
    } catch {
      // The default stands.
    }
    flow.requestWords(Object.keys(STANDINGS_WORDS));
    // The rows' owners' pictures: the client's own logo tables, and the image server's portraits.
    flow.loadOwnerLogos();
    flow.loadImageServer();
    // The skill bonus goes by each owner's faction and the pilot's skills.
    flow.loadCorporationFactions();
    if (store.skills.get().skills === null) void flow.loadSkills().catch(() => {});
  });

  // The agents among the standings' owners, each asked once (agents.GetAgentByID: whether it is an agent, its level
  // and its faction); and the race's faction's name, which the pilot's list shows at nought where it has no standing.
  $effect(() => {
    for (const rows of [$standings.char, $standings.corp]) {
      for (const row of rows ?? []) {
        if (classifyStandingKind(row.fromID) === "agent") flow.requestAgentRecord(row.fromID);
      }
    }
  });
  $effect(() => {
    const raceID = $station.online?.raceID ?? null;
    const factionID = raceID === null ? null : ({ 1: 500001, 2: 500002, 4: 500003, 8: 500004 } as Record<number, number>)[raceID];
    if (factionID !== undefined && factionID !== null) flow.requestNames([{ kind: "faction", id: factionID }]);
  });

  // The name for a standing's entity, ALWAYS a name and never the id (R7d).
  function entityName(fromID: number): string {
    const kind = classifyStandingKind(fromID);
    if (kind === null) {
      return "Unknown entity";
    }
    return resolvedName($names.resolved, kind, fromID, "Unknown entity");
  }
  /** A tag's name: an owner by the kind its number is kept under. */
  const nameOf = (kind: NameKind, id: number): string => (kind === "owner" ? entityName(id) : resolvedName($names.resolved, kind, id, ""));
  function word(label: string, args: Readonly<Record<string, JsonValue>> = {}): string {
    const template = $words.templates[label];
    return formatTemplate(typeof template === "string" ? template : STANDINGS_WORDS[label] ?? "", args, { nameOf });
  }

  /** Each panel's groups (ui/standingsList.ts): the pilot's with its skill bonus and its race's faction. */
  function listGroups(scope: "char" | "corp", rows: readonly CharStanding[]) {
    return standingsListGroups(
      {
        rows,
        forPilot: scope === "char",
        raceID: $station.online?.raceID ?? null,
        agentOf: (ownerID) => {
          const records = $agents.agentRecords;
          if (!(ownerID in records)) return undefined;
          const record = records[ownerID];
          return record ? { level: record.level, factionID: record.factionID } : null;
        },
        factionOfCorporation: (corporationID) => $corporationFactions?.[String(corporationID)] ?? null,
        skillLevel: (typeID) => ($skills.skills ?? []).find((skill) => skill.typeID === typeID)?.level ?? 0,
        ownerName: entityName,
        agentName: (agentID, level) => word("UI/Agents/AgentEntryNameAndLevel", { ownerID: agentID, level: level ?? 0 }),
      },
      sort,
      searchText[scope],
    );
  }

  /** What each panel's quick filter holds, and the text it filters by: taken 0.4 s after the first key (SetQuickFilterInput). */
  let searchInput = $state<Record<"char" | "corp", string>>({ char: "", corp: "" });
  let searchText = $state<Record<"char" | "corp", string>>({ char: "", corp: "" });
  const searchTimers: Record<"char" | "corp", ReturnType<typeof setTimeout> | null> = { char: null, corp: null };
  function typed(scope: "char" | "corp", value: string): void {
    searchInput[scope] = value;
    if (searchTimers[scope] !== null) return;
    searchTimers[scope] = setTimeout(() => {
      searchTimers[scope] = null;
      searchText[scope] = searchInput[scope];
    }, 400);
  }

  // standingEntry.ShowInfo (OnDblClick): Show Info on the owner, a faction, an NPC corporation or an agent.
  function infoOf(fromID: number): InfoSubject | null {
    switch (classifyStandingKind(fromID)) {
      case "faction":
        return { kind: "faction", factionID: fromID };
      case "corporation":
        return { kind: "corporation", corporationID: fromID };
      case "agent":
        return { kind: "character", characterID: fromID };
      default:
        return null;
    }
  }

  /**
   * standingEntry.UpdateIcon: a faction's or a corporation's logo (eveIcon.GetLogoIcon: LogoIcon, the client's own
   * tables), a character's portrait (photo.GetPortrait(ownerID, 64), the client's silhouette where the image server
   * has none). The pictures to try, in turn.
   */
  function pictureOf(fromID: number): readonly string[] {
    const kind = classifyStandingKind(fromID);
    if (kind === "agent") {
      const portrait = portraitUrl($imageServer, fromID, 64);
      return [...(portrait === null ? [] : [portrait]), clientTexture(portraitDefaultPath(64))];
    }
    const resPath = kind === "faction" ? $ownerLogos?.factions[String(fromID)] : kind === "corporation" ? $ownerLogos?.corporations[String(fromID)] : undefined;
    return resPath ? [clientTexture(resPath)] : [];
  }

  // A composition owner is a corporation member (a player character); it may not
  // resolve from static data, so it degrades honestly rather than leaking the id.
  function memberName(ownerID: number): string {
    return resolvedName($names.resolved, "character", ownerID, "Unknown entity");
  }

  // The signed standing to two decimals, e.g. "+2.14" / "−1.30" / "0.00".
  function standingText(standing: number): string {
    const rounded = Math.round(standing * 100) / 100;
    if (rounded > 0) {
      return `+${rounded.toFixed(2)}`;
    }
    if (rounded < 0) {
      // A real minus sign, not a hyphen.
      return `−${Math.abs(rounded).toFixed(2)}`;
    }
    return "0.00";
  }

  function standingTone(standing: number): "good" | "bad" | "neutral" {
    if (standing > 0) {
      return "good";
    }
    if (standing < 0) {
      return "bad";
    }
    return "neutral";
  }

  function toggleDetail(fromID: number, scope: "char" | "corp"): void {
    if ($standings.detailFromID === fromID && $standings.detailScope === scope) {
      flow.closeStandingDetail();
      return;
    }
    void run(() => flow.loadStandingDetail(fromID, scope));
  }

  function isOpen(fromID: number, scope: "char" | "corp"): boolean {
    return $standings.detailFromID === fromID && $standings.detailScope === scope;
  }

  // A standing-history event's plain-language label (R9a), from its eventTypeID.
  const EVENT_LABELS: Readonly<Record<number, string>> = {
    25: "Standing reset",
    65: "Standing set",
    68: "Corp standing set",
    73: "Mission completed",
    74: "Mission failed",
    75: "Mission declined",
    76: "Combat aggression",
    80: "Mission bonus",
    82: "Derived (rise)",
    83: "Derived (fall)",
    84: "Standing set",
    90: "Offer expired",
    126: "Contraband trafficking",
    485: "Group reward (corporation)",
    486: "Group reward (faction)",
  };

  function eventLabel(eventTypeID: number): string {
    return EVENT_LABELS[eventTypeID] ?? "Standing change";
  }

  // A retail FILETIME (100 ns ticks since 1601) as a plain date. Never a number.
  function whenText(filetime: bigint | null): string {
    if (filetime === null) {
      return "—";
    }
    const unixMs = Number(filetime / 10000n - 11644473600000n);
    if (!Number.isFinite(unixMs)) {
      return "—";
    }
    return new Date(unixMs).toLocaleDateString();
  }
</script>

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">Standings</h2>
    <span class="controls">
      <!-- The sort menu (MenuButtonIcon: standingsFilterSettings.get_menu): its heading, then each sort to choose. -->
      <span class="standings-sort">
        <button type="button" title={word("UI/Common/SortBy")} aria-haspopup="menu" aria-expanded={sortMenuOpen} onclick={() => (sortMenuOpen = !sortMenuOpen)}>⇅</button>
        {#if sortMenuOpen}
          <span class="standings-sort-menu" role="menu">
            <span class="standings-sort-heading">{word("UI/Standings/SortingHeader")}</span>
            {#each STANDINGS_SORTS as option (option.value)}
              <button type="button" role="menuitemradio" aria-checked={sort === option.value} class:chosen={sort === option.value} onclick={() => chooseSort(option.value)}>{word(option.label)}</button>
            {/each}
          </span>
        {/if}
      </span>
      <button type="button" disabled={busy} onclick={refresh}>Refresh</button>
    </span>
  </header>
  <p class="note">Standings run from −10 to +10.</p>

  {#if error}
    <p class="error">Could not read your standings: {error}</p>
  {/if}

  {#snippet standingRow(entry: StandingsListEntry, scope: "char" | "corp")}
    <li class="standing">
      <button
        type="button"
        class="row"
        class:open={isOpen(entry.ownerID, scope)}
        onclick={() => toggleDetail(entry.ownerID, scope)}
        ondblclick={() => {
          const subject = infoOf(entry.ownerID);
          if (subject !== null) showInfo(subject);
        }}
      >
        <!-- StandingEntry.Load: the picture, then "<standing> <name>", the name dimmer. -->
        <OwnerPicture name={plainText(entry.ownerName)} urls={pictureOf(entry.ownerID)} />
        <span class="name"><span class="standing-entry-value">{entry.standingText + " "}</span><span class="standing-entry-owner">{plainText(entry.ownerName)}</span></span>
      </button>

      {#if isOpen(entry.ownerID, scope)}
        <div class="detail">
          {#if $standings.detailError}
            <p class="error">The details could not be read: {$standings.detailError}</p>
          {:else if scope === "char"}
            {#if $standings.transactions === null}
              <p class="empty">Reading the history…</p>
            {:else if $standings.transactions.length === 0}
              <p class="empty">No recorded changes for this standing.</p>
            {:else}
              <table class="drill">
                <thead>
                  <tr><th scope="col">When</th><th scope="col">Event</th><th scope="col" class="num">Change</th></tr>
                </thead>
                <tbody>
                  {#each $standings.transactions as tx (tx.id)}
                    <tr>
                      <td>{whenText(tx.date)}</td>
                      <td>{eventLabel(tx.eventTypeID)}</td>
                      <td class="num">{standingText(tx.modification)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          {:else if $standings.compositions === null}
            <p class="empty">Reading the breakdown…</p>
          {:else if $standings.compositions.length === 0}
            <p class="empty">No members contribute to this corporation standing.</p>
          {:else}
            <table class="drill">
              <thead>
                <tr><th scope="col">Member</th><th scope="col" class="num">Standing</th></tr>
              </thead>
              <tbody>
                {#each $standings.compositions as comp (comp.ownerID)}
                  <tr>
                    <td>{memberName(comp.ownerID)}</td>
                    <td class="num {standingTone(comp.standing)}">{standingText(comp.standing)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </li>
  {/snippet}

  {#snippet standingList(rows: readonly CharStanding[] | null, err: string | null, scope: "char" | "corp")}
    <!-- The panel's quick filter (QuickFilterEdit). -->
    <p class="standings-filter">
      <input type="search" placeholder={word("UI/Common/Search")} aria-label={word("UI/Common/Search")} value={searchInput[scope]} oninput={(event) => typed(scope, (event.currentTarget as HTMLInputElement).value)} />
    </p>
    {#if err}
      <p class="error">{err}</p>
    {:else if rows === null}
      <p class="empty">Reading standings…</p>
    {:else}
      {@const groups = listGroups(scope, rows)}
      {#if groups.length === 0}
        <!-- The scroll's noContentHint. -->
        <p class="empty">{word("UI/Standings/NoResultsFound")}</p>
      {:else}
        {#each groups as group (group.kind)}
          <h4>{word(STANDINGS_GROUP_LABELS[group.kind])}</h4>
          <ul class="standings">
            {#each group.entries as entry (entry.ownerID)}
              {@render standingRow(entry, scope)}
            {/each}
          </ul>
        {/each}
      {/if}
    {/if}
  {/snippet}

  <h3>Your standings</h3>
  {@render standingList($standings.char, $standings.charError, "char")}

  <h3>Your corporation's standings</h3>
  {@render standingList($standings.corp, $standings.corpError, "corp")}

</section>

<style>
  ul.standings {
    list-style: none;
    margin: 0 0 0.75rem 0;
    padding: 0;
  }
  .standing {
    margin: 0;
  }
  button.row {
    display: grid;
    grid-template-columns: 32px minmax(8rem, 1fr);
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 40px;
    padding: 0.35rem 0.5rem;
    background: transparent;
    border: 0;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  button.row:hover,
  button.row.open {
    background: rgba(128, 128, 128, 0.12);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .standing-entry-owner {
    color: var(--color-muted);
  }
  .standings-filter {
    margin: 0 0 0.4rem;
  }
  .standings-filter input {
    width: 100%;
    max-width: 18rem;
  }
  .standings-sort {
    position: relative;
  }
  .standings-sort-menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 5;
    display: flex;
    flex-direction: column;
    min-width: 10rem;
    padding: 0.25rem;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-strong);
  }
  .standings-sort-menu button {
    text-align: left;
  }
  .standings-sort-menu button.chosen::before {
    content: "● ";
  }
  .standings-sort-heading {
    padding: 0.2rem 0.4rem;
    color: var(--color-muted);
  }
  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  /* The meter: a centre-anchored track; the fill grows toward the sign's end. */
  .track {
    position: relative;
    display: block;
    height: 8px;
    border-radius: 2px;
    background: rgba(128, 128, 128, 0.2);
  }
  .track::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: rgba(128, 128, 128, 0.6);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    border-radius: 2px;
  }
  .fill.left {
    left: auto;
    right: 50%;
  }
  .good {
    color: #2e7d32;
  }
  .bad {
    color: #c62828;
  }
  .fill.good {
    background: #2e7d32;
  }
  .fill.bad {
    background: #c62828;
  }
  .fill.neutral {
    background: rgba(128, 128, 128, 0.5);
  }
  .detail {
    padding: 0.25rem 0.5rem 0.75rem;
  }
  table.drill {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }
  table.drill th,
  table.drill td {
    padding: 0.2rem 0.4rem;
    text-align: left;
  }
  table.drill .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-color-scheme: dark) {
    .good,
    .fill.good {
      color: #7fce82;
    }
    .fill.good {
      background: #7fce82;
    }
    .bad,
    .fill.bad {
      color: #ef8a8a;
    }
    .fill.bad {
      background: #ef8a8a;
    }
  }
</style>
