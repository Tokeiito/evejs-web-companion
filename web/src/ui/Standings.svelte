<script lang="ts">
  // The standings: the pilot's (the Character Sheet's Standings panel, charsheet/standingsPanel/standingsPanel.py,
  // toID the pilot) and its corporation's (the Corporation window's NPC Standings panel, the same panel toID the
  // corporation). Each lists the owners that stand toward it as the client's list does (ui/standingsList.ts): its
  // groups, each entry's picture and "<standing> <name>", its quick filter, and the sort the panels share
  // (standingsConst STANDING_SORT_SETTING, kept in this browser as the client keeps it among its settings).
  //
  // THE SELECTED OWNER (OnScrollSelectionChange, UpdateSelectedEntry): the one clicked, and when the pilot's list loads
  // the one last chosen there (settings.char.ui charactersheetStandingsPanelOwner, kept in this browser for the pilot)
  // or its first. Beside the list its header (StandingsHeader: its picture, name and standing toward the panel's owner),
  // then the pilot's history with it (StandingsHistoryScroll) or what the corporation's members make of the
  // corporation's (StandingCompositionScroll).
  //
  // Not as the client's yet: the standings bar, the graph and the header's buttons; one selected owner for the two
  // lists (the client's two panels have one each); and the two panels are one window, not the Character Sheet's and
  // the Corporation window's.
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
  import { DATE_LABELS, formatTemplate, plainText } from "../bridge/clientWords.ts";
  import {
    STANDING_CHANGE_WORDS,
    compositionStandingText,
    roundStandingChange,
    standingChangeText,
    standingChangeWords,
    standingEventIcon,
    type StandingChangeWording,
  } from "../bridge/standingTransactions.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import { showInfo, type InfoSubject } from "./showInfo.ts";
  import OwnerPicture from "./OwnerPicture.svelte";
  import StandingsBar from "./StandingsBar.svelte";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { portraitDefaultPath, portraitUrl } from "./ownerImages.ts";
  import {
    DEFAULT_STANDINGS_SORT,
    STANDINGS_GROUP_LABELS,
    STANDINGS_SORTS,
    pyStandingText,
    standingUsed,
    standingsListGroups,
    type StandingsListEntry,
    type StandingsListInputs,
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
    "UI/Common/Date": "When",
    "UI/Common/Change": "By",
    "UI/Common/Reason": "Why",
    "UI/Common/Name": "Member",
    "UI/Common/Standing": "Standing",
    "UI/Standings/NoStandingsTransactions": "{ownerName} has not changed its standing toward you.",
    "UI/Standings/StandingsBarHint": "{[character]owner.name} toward you: <b>{standing}</b>",
    "UI/Standings/StandingsBarHintToCorp": "{[character]owner.name} toward {corpName}: <b>{standing}</b>",
    "UI/Standings/CompositionWindow/NPCToPlayerCorp": "An NPC's standing toward a player corporation is its members' standings averaged, of those a week or more in it.",
    [DATE_LABELS.sn!]: "{[datetime]datetime}",
    ...STANDING_CHANGE_WORDS,
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
  /** What a panel's list is made of (ui/standingsList.ts): its standings, and what the client knows to word them. */
  function inputsOf(scope: "char" | "corp", rows: readonly CharStanding[]): StandingsListInputs {
    return {
      rows,
      forPilot: scope === "char",
      raceID: $station.online?.raceID ?? null,
      agentOf: (ownerID) => {
        const records = $agents.agentRecords;
        if (!(ownerID in records)) return undefined;
        const record = records[ownerID];
        return record ? { level: record.level, corporationID: record.corporationID, factionID: record.factionID } : null;
      },
      factionOfCorporation: (corporationID) => $corporationFactions?.[String(corporationID)] ?? null,
      skillLevel: (typeID) => ($skills.skills ?? []).find((skill) => skill.typeID === typeID)?.level ?? 0,
      ownerName: entityName,
      agentName: (agentID, level) => word("UI/Agents/AgentEntryNameAndLevel", { ownerID: agentID, level: level ?? 0 }),
    };
  }
  function listGroups(scope: "char" | "corp", rows: readonly CharStanding[], search: string = searchText[scope]) {
    return standingsListGroups(inputsOf(scope, rows), sort, search);
  }

  /**
   * The standings bar for a panel's selected owner (StandingsBar.Update(fromID, toID)): its standing toward the panel's
   * owner, the standing it deals with the pilot by (GetStandingUsed, from the pilot's own standings whichever the
   * panel), and their hints.
   */
  function barOf(scope: "char" | "corp"): { standing: number; derived: number; hint: string; derivedHint: string } | null {
    if ($standings.detailScope !== scope || $standings.detailFromID === null) return null;
    const ownerID = $standings.detailFromID;
    const entry = entryOf(scope, ownerID);
    if (entry === null) return null;
    const used = standingUsed(inputsOf("char", $standings.char ?? []), ownerID, entry.standing);
    const corpName = resolvedName($names.resolved, "corporation", $station.online?.corporationID ?? 0, "");
    const hintOf = (owner: number | null, standing: number): string =>
      plainText(scope === "corp"
        ? word("UI/Standings/StandingsBarHintToCorp", { owner: owner ?? 0, corpName, standing: pyStandingText(standing) })
        : word("UI/Standings/StandingsBarHint", { owner: owner ?? 0, standing: pyStandingText(standing) }));
    return { standing: entry.standing, derived: used.standing, hint: hintOf(ownerID, entry.standing), derivedHint: hintOf(used.ownerID, used.standing) };
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

  /** settings.char.ui charactersheetStandingsPanelOwner: the owner last chosen in the pilot's list, kept per pilot. */
  const OWNER_SETTING_KEY = "charactersheetStandingsPanelOwner";
  function keptOwner(characterID: number): number | null {
    try {
      const kept = Number(localStorage.getItem(`${OWNER_SETTING_KEY}:${characterID}`));
      return Number.isSafeInteger(kept) && kept > 0 ? kept : null;
    } catch {
      return null;
    }
  }
  /** An entry clicked (its OnClick keeps it for the pilot's list), and its details read where it is not the selected one. */
  function selectEntry(ownerID: number, scope: "char" | "corp"): void {
    const characterID = store.station.get().online?.characterID ?? null;
    if (scope === "char" && characterID !== null) {
      try {
        localStorage.setItem(`${OWNER_SETTING_KEY}:${characterID}`, String(ownerID));
      } catch {
        // Not kept: the first is chosen next time.
      }
    }
    if (isOpen(ownerID, scope)) return;
    void run(() => flow.loadStandingDetail(ownerID, scope));
  }

  function isOpen(fromID: number, scope: "char" | "corp"): boolean {
    return $standings.detailFromID === fromID && $standings.detailScope === scope;
  }

  // LoadPanel: when the pilot's list is first had, the owner kept is selected, else its first.
  let firstSelected = false;
  $effect(() => {
    const rows = $standings.char;
    const characterID = $station.online?.characterID ?? null;
    if (firstSelected || rows === null || characterID === null) return;
    if (store.standings.get().detailFromID !== null) {
      firstSelected = true;
      return;
    }
    const entries = listGroups("char", rows, "").flatMap((group) => group.entries);
    if (entries.length === 0) return;
    firstSelected = true;
    const kept = keptOwner(characterID);
    const chosen = entries.find((entry) => entry.ownerID === kept) ?? entries[0]!;
    void run(() => flow.loadStandingDetail(chosen.ownerID, "char"));
  });

  /** The kind an owner's name is kept under (cfg.eveowners): null for a number that is no owner. */
  function ownerKindOf(id: number): NameKind | null {
    if (id >= 500_000 && id < 600_000) return "faction";
    if ((id >= 1_000_000 && id < 2_000_000) || (id >= 98_000_000 && id < 99_000_000)) return "corporation";
    if (id >= 99_000_000 && id < 100_000_000) return "alliance";
    if (id >= 3_000_000 && id < 4_000_000) return "agent";
    if (id >= 90_000_000) return "character";
    return null;
  }
  /** The kind a place's name is kept under (cfg.evelocations): null for a number that is no place. */
  function locationKindOf(id: number): NameKind | null {
    if (id >= 10_000_000 && id < 20_000_000) return "region";
    if (id >= 20_000_000 && id < 30_000_000) return "constellation";
    if (id >= 30_000_000 && id < 40_000_000) return "system";
    if (id >= 60_000_000 && id < 64_000_000) return "station";
    return null;
  }
  /** idCheckers.IsNPC. */
  const isNpc = (id: number): boolean => id > 10_000 && id < 90_000_000;

  /** What FmtStandingTransaction asks of the client: its words, the owners' and places' names, a mission's name. */
  const wording: StandingChangeWording = {
    template: (label) => {
      const template = $words.templates[label];
      return typeof template === "string" ? template : STANDINGS_WORDS[label] ?? "";
    },
    fill: (template, args) => formatTemplate(template, args, { nameOf }),
    ownerName: (id) => {
      const kind = ownerKindOf(id);
      return kind === null ? null : kind === "agent" ? entityName(id) : resolvedName($names.resolved, kind, id, "");
    },
    locationName: (id) => {
      const kind = locationKindOf(id);
      return kind === null ? null : resolvedName($names.resolved, kind, id, "");
    },
    messageText: (id) => {
      if (!(id > 0)) return null;
      const text = $words.templates[`#${id}`];
      return text === undefined ? undefined : text;
    },
    corporationFaction: (id) => $corporationFactions?.[String(id)] ?? null,
  };

  // The names and messages the history's reasons name: its owners, its places, its missions' names.
  $effect(() => {
    const refs: { kind: NameKind; id: number }[] = [];
    const messages: string[] = [];
    for (const tx of $standings.transactions ?? []) {
      for (const id of [tx.fromID, tx.int1, tx.int2, tx.int3]) {
        if (id === null || !(id > 0)) continue;
        const kind = ownerKindOf(id) ?? locationKindOf(id);
        if (kind !== null && kind !== "agent") refs.push({ kind, id });
      }
      if (tx.int3 !== null && tx.int3 > 0) refs.push({ kind: "type", id: tx.int3 });
      if (tx.int1 !== null && tx.int1 > 0 && [73, 74, 75, 90].includes(tx.eventTypeID)) messages.push(`#${tx.int1}`);
    }
    if (refs.length > 0) flow.requestNames(refs);
    if (messages.length > 0) flow.requestWords(messages);
  });

  /** FmtDate(eventDateTime, 'sn'). */
  function dateText(filetime: bigint | null): string {
    if (filetime === null) return "";
    return formatTemplate(wording.template(DATE_LABELS.sn!), { datetime: { type: "long", value: filetime.toString() } } as Record<string, JsonValue>, { nameOf });
  }

  /** The selected owner's entry in its list (whatever the quick filter holds). */
  function entryOf(scope: "char" | "corp", ownerID: number): StandingsListEntry | null {
    const rows = scope === "char" ? $standings.char : $standings.corp;
    if (rows === null) return null;
    return listGroups(scope, rows, "").flatMap((group) => group.entries).find((entry) => entry.ownerID === ownerID) ?? null;
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
        onclick={() => selectEntry(entry.ownerID, scope)}
        ondblclick={() => {
          const subject = infoOf(entry.ownerID);
          if (subject !== null) showInfo(subject);
        }}
      >
        <!-- StandingEntry.Load: the picture, then "<standing> <name>", the name dimmer. -->
        <OwnerPicture name={plainText(entry.ownerName)} urls={pictureOf(entry.ownerID)} />
        <span class="name"><span class="standing-entry-value">{entry.standingText + " "}</span><span class="standing-entry-owner">{plainText(entry.ownerName)}</span></span>
      </button>
    </li>
  {/snippet}

  <!-- The panel's right side for its selected owner. -->
  {#snippet standingDetail(scope: "char" | "corp")}
    {#if $standings.detailScope === scope && $standings.detailFromID !== null}
      {@const ownerID = $standings.detailFromID}
      {@const entry = entryOf(scope, ownerID)}
      <div class="standings-detail">
        <!-- StandingsHeader: the owner's picture, its name, its standing toward the panel's owner. -->
        <header class="standings-detail-head">
          <OwnerPicture name={entry ? plainText(entry.ownerName) : entityName(ownerID)} urls={pictureOf(ownerID)} size={64} />
          <span class="standings-detail-name">{entry ? plainText(entry.ownerName) : entityName(ownerID)}</span>
          {#if entry}<span class="standings-detail-standing">{entry.standingText}</span>{/if}
        </header>
        {#if $standings.detailError}
          <p class="error">The details could not be read: {$standings.detailError}</p>
        {:else if scope === "char"}
          {#if $standings.transactions === null}
            <p class="empty">Reading the history…</p>
          {:else if $standings.transactions.length === 0}
            <!-- The scroll's noContentHint. -->
            <p class="empty">{word("UI/Standings/NoStandingsTransactions", { ownerName: entityName(ownerID) })}</p>
          {:else}
            <!-- StandingsHistoryEntry: the event's icon, its date, its change, and the reason, its body the hint. -->
            <table class="drill standings-history">
              <thead>
                <tr><th scope="col"></th><th scope="col">{word("UI/Common/Date")}</th><th scope="col" class="num">{word("UI/Common/Change")}</th><th scope="col">{word("UI/Common/Reason")}</th></tr>
              </thead>
              <tbody>
                {#each $standings.transactions as tx (tx.id)}
                  {@const reason = standingChangeWords(tx, wording)}
                  {@const change = standingChangeText(roundStandingChange(tx.modification))}
                  <tr title={plainText(reason.body) || undefined}>
                    <td><img src={clientTexture(standingEventIcon(tx.eventTypeID))} alt="" width="26" height="26" /></td>
                    <td>{dateText(tx.date)}</td>
                    <td class="num {change.tone}">{change.text}</td>
                    <td>{plainText(reason.subject)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {:else}
          <p class="note">{word("UI/Standings/CompositionWindow/NPCToPlayerCorp")}</p>
          {#if $standings.compositions === null}
            <p class="empty">Reading the breakdown…</p>
          {:else}
            {@const members = $standings.compositions.filter((comp) => !isNpc(comp.ownerID))}
            {#if members.length === 0}
              <p class="empty">{word("UI/Standings/NoStandingsTransactions", { ownerName: entityName(ownerID) })}</p>
            {:else}
              <!-- StandingCompositionEntry: the member's portrait, its name, its standing. -->
              <table class="drill">
                <thead>
                  <tr><th scope="col"></th><th scope="col">{word("UI/Common/Name")}</th><th scope="col" class="num">{word("UI/Common/Standing")}</th></tr>
                </thead>
                <tbody>
                  {#each members as comp (comp.ownerID)}
                    {@const standing = compositionStandingText(comp.standing)}
                    {@const portrait = portraitUrl($imageServer, comp.ownerID, 32)}
                    <tr>
                      <td><OwnerPicture name={memberName(comp.ownerID)} urls={[...(portrait === null ? [] : [portrait]), clientTexture(portraitDefaultPath(32))]} size={32} /></td>
                      <td>{memberName(comp.ownerID)}</td>
                      <td class="num {standing.tone}">{standing.text}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          {/if}
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet standingList(rows: readonly CharStanding[] | null, err: string | null, scope: "char" | "corp")}
    <!-- The panel's standings bar, for its selected owner, across its top. -->
    {@const bar = barOf(scope)}
    {#if bar !== null}
      <StandingsBar standing={bar.standing} usedStanding={bar.derived} hint={bar.hint} derivedHint={bar.derivedHint} />
    {/if}
    <div class="standings-panel">
    <div class="standings-left">
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
    </div>
    {@render standingDetail(scope)}
    </div>
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
  /* The panel: its list on the left, its selected owner on the right (one above the other where narrow). */
  .standings-panel {
    display: grid;
    grid-template-columns: minmax(14rem, 2fr) minmax(0, 3fr);
    gap: 0.75rem;
    align-items: start;
  }
  @media (max-width: 720px) {
    .standings-panel {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .standings-detail {
    min-width: 0;
  }
  .standings-detail-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .standings-detail-name {
    flex: 1;
    min-width: 0;
    font-size: 1.1em;
  }
  .standings-detail-standing {
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .standings-history img {
    display: block;
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
