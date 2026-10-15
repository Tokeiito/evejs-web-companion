<script lang="ts">
  // The client's Locations window (neocom/locations/window.py LocationsWindow): its Locations tab, the bookmarks
  // panel (neocom/addressBook/bookmarksPanel.py), as bridge/locationsList.ts builds the list from the pilot's
  // folders, bookmarks and subfolders (accessGroupBookmarkMgr.GetMyActiveBookmarks, the page's own read):
  //
  //   "Locations in <system>", "Personal Locations [n]" and "Shared Locations [n]", each group closed until it is
  //   opened, its open state kept for the pilot (the client's list registry keeps it); a section's folders, then its
  //   offline folders; a folder's subfolders, then its bookmarks; a bookmark's row under the client's nine headers
  //   (Label, Type, Jumps, SOL, CON, REG, Date, Expiry, Creator), its hint the label and its note's first fifty
  //   characters.
  //
  // Its bottom's Add Location (window.py 104 to 108: addressbookService.BookmarkCurrentLocation) opens the bookmark
  // window (BookmarkWindow.svelte) for the station the pilot is docked in, or the ship's spot in space; the list is
  // read again once a place is saved.
  //
  // Not here yet: the Search tab, the Agent Missions group (the agents' bookmarks), the folders the pilot may
  // administer, Create Folder and Create Subfolder, a structure's Add Location, the rows' and the folders' menus, and
  // a shared bookmark shown dim before its delay has passed.
  import { onMount } from "svelte";
  import { formatTemplate, plainText, type TemplateArguments } from "../bridge/clientWords.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import {
    isCoordinateBookmark,
    jumpsSystemOf,
    locationsSection,
    placesInSystem,
    solSystemOf,
    subfolderNameOf,
    unzipMemo,
    type LocationsSection,
  } from "../bridge/locationsList.ts";
  import type { ActiveBookmarks, Bookmark, Subfolder } from "../bridge/bookmarks.ts";
  import type { BookmarkPlace } from "../bridge/locationsList.ts";
  import BookmarkWindow from "./BookmarkWindow.svelte";
  import { isSessionLost } from "../app/flow.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;

  /** The window's words (window.py 22 to 37; bookmarksPanel.py 42 to 51, 173 to 300, 340 to 544). */
  const WORDS = {
    title: "UI/PeopleAndPlaces/Locations",
    label: "UI/PeopleAndPlaces/Label",
    type: "UI/Common/Type",
    jumps: "UI/PeopleAndPlaces/Jumps",
    sol: "UI/PeopleAndPlaces/Sol",
    con: "UI/PeopleAndPlaces/Con",
    reg: "UI/PeopleAndPlaces/Reg",
    date: "UI/Common/Date",
    expiry: "UI/AclBookmarks/Expiry",
    creator: "UI/PeopleAndPlaces/Creator",
    inSystem: "UI/AclBookmarks/LocationsInSystem",
    personal: "UI/PeopleAndPlaces/PersonalLocations",
    shared: "UI/PeopleAndPlaces/SharedLocations",
    inactive: "UI/AclBookmarks/InactiveFolders",
    folderName: "UI/PeopleAndPlaces/FolderName",
    coordinate: "UI/PeopleAndPlaces/Coordinate",
    unreachable: "UI/Common/unreachable",
    personalFolder: "UI/AclBookmarks/PersonalFolderType",
    sharedFolder: "UI/AclBookmarks/SharedFolderType",
    dateTime: "/Carbon/UI/Common/DateTime/DateLongShort",
    addBookmark: "UI/PeopleAndPlaces/AddBookmark",
    placeLabel: "UI/PeopleAndPlaces/NewBookmarkLocationLabel",
    spot: "UI/PeopleAndPlaces/SpotInSolarSystem",
    notHere: "dialog:HavetobeatstationOrinShip/body",
  } as const;

  /** The client's word for a label, from the player's install; the page's own where there is none to read. */
  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(template) : own;
  }

  function filled(label: string, own: string, args: TemplateArguments): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" ? template : own, args, {
      nameOf: (kind, id) => resolvedName($names.resolved, kind, id, ""),
    }));
  }

  /** A system subfolder's name is a label (ConvertSubfolderName). */
  const label = (path: string): string => word(path, path);

  let active = $state<ActiveBookmarks | null>(null);
  let error = $state("");

  /** The client's session.solarsystemid2: the flight's system as last read, else the online pilot's. */
  const systemID = $derived($flight.status?.solarSystemID ?? $station.online?.solarSystemID ?? null);
  const pilotID = $derived($station.online?.characterID ?? null);

  // The groups open (the list registry's open states, kept for the character): closed until opened.
  let open = $state<readonly string[]>([]);
  const openKey = (id: number | null): string => `evejs.locations.open.${id ?? 0}`;
  $effect(() => {
    try {
      const kept: unknown = JSON.parse(globalThis.localStorage?.getItem(openKey(pilotID)) ?? "[]");
      open = Array.isArray(kept) ? kept.filter((each): each is string => typeof each === "string") : [];
    } catch {
      open = [];
    }
  });
  function isOpen(id: string): boolean {
    return open.includes(id);
  }
  function toggle(id: string): void {
    open = isOpen(id) ? open.filter((each) => each !== id) : [...open, id];
    try {
      globalThis.localStorage?.setItem(openKey(pilotID), JSON.stringify(open));
    } catch {
      // Not kept: the groups hold for this window's life.
    }
  }

  const sections = $derived<readonly LocationsSection[]>(active === null ? [] : [locationsSection(active, true, label), locationsSection(active, false, label)]);
  const local = $derived(active === null ? [] : placesInSystem(active, systemID));

  /** The bookmark window, open for a place, or none. */
  let bookmarking = $state<BookmarkPlace | null>(null);

  /**
   * Add Location (BookmarkCurrentLocation, addressbookService.py 376 to 394): the station the pilot is docked in, by
   * its default name (GetDefaultLocationName: "<station> ( <its type> )"); else the ship's spot in space ("spot in
   * <system> solar system"); else the client's HavetobeatstationOrinShip.
   */
  function addLocation(): void {
    error = "";
    const status = $flight.status;
    const docked = status !== null ? (status.docked ? status.stationID : null) : ($station.online?.stationID ?? null);
    const structure = status !== null ? status.structureID : ($station.online?.structureID ?? null);
    if (docked !== null) {
      flow.requestNames([{ kind: "station", id: docked }, { kind: "stationType", id: docked }]);
      const typeName = (): string => resolvedName($names.resolved, "stationType", docked, "");
      bookmarking = {
        itemID: docked,
        askIfKnown: true,
        typeName,
        name: () => filled(WORDS.placeLabel, "{[location] loc.name} ( {group} )", { loc: docked, group: typeName() }),
      };
    } else if (structure !== null) {
      error = "Saving a structure's place is not here yet.";
    } else if (status !== null && status.inSpace && status.shipID !== null) {
      const solarSystemID = status.solarSystemID;
      bookmarking = {
        itemID: status.shipID,
        askIfKnown: false,
        typeName: () => "",
        name: () => filled(WORDS.spot, "a spot in {solarSystemName}", { solarSystemName: solarSystemID === null ? "" : resolvedName($names.resolved, "system", solarSystemID, "") }),
      };
    } else {
      error = word(WORDS.notHere, "Be docked, or in a ship, to save where you are.");
    }
  }

  function bookmarkDone(made: boolean): void {
    bookmarking = null;
    if (made) void load();
  }

  async function load(): Promise<void> {
    error = "";
    try {
      active = await flow.readLocations();
    } catch (cause) {
      error = isSessionLost(cause) ? "Your session ended. Pick your character again." : cause instanceof Error ? cause.message : String(cause);
    }
  }

  onMount(() => {
    flow.requestWords(Object.values(WORDS));
    void load();
  });

  // What the rows name: their systems, the systems' constellations and regions, their types' groups, their makers;
  // the jumps to their systems; and the system subfolders' labels.
  $effect(() => {
    if (active === null) return;
    const refs: NameRef[] = [];
    const systems = new Set<number>();
    for (const bookmark of active.bookmarks) {
      const sol = solSystemOf(bookmark);
      if (sol !== null) refs.push({ kind: "system", id: sol }, { kind: "systemConstellation", id: sol }, { kind: "systemRegion", id: sol });
      const jumpsTo = jumpsSystemOf(bookmark);
      if (jumpsTo !== null) systems.add(jumpsTo);
      refs.push({ kind: "typeGroup", id: bookmark.typeID });
      if (bookmark.creatorID !== null) refs.push({ kind: "owner", id: bookmark.creatorID });
    }
    for (const subfolder of active.subfolders) {
      if (subfolder.creatorID !== null && subfolder.creatorID !== 1) refs.push({ kind: "character", id: subfolder.creatorID });
    }
    if (systemID !== null) refs.push({ kind: "system", id: systemID });
    if (refs.length > 0) flow.requestNames(refs);
    if (systemID !== null && systems.size > 0) flow.requestAutopilotJumps(systemID, [...systems]);
    const systemLabels = active.subfolders.filter((subfolder) => subfolder.creatorID === 1).map((subfolder) => subfolder.subfolderName);
    if (systemLabels.length > 0) flow.requestWords(systemLabels);
  });

  /** A subfolder's line (GetSubfolderEntry, 345 to 351): the system's by its label, another's with its maker. */
  function subfolderLine(subfolder: Subfolder): string {
    if (subfolder.creatorID === null || subfolder.creatorID === 1) return subfolderNameOf(subfolder, label);
    return filled(WORDS.folderName, "{folderName} ({[character]creator.name})", { folderName: subfolder.subfolderName, creator: subfolder.creatorID });
  }

  function dateText(filetime: bigint | null): string {
    return filetime === null ? "-" : filled(WORDS.dateTime, "{[datetime]datetime}", { datetime: String(filetime) });
  }

  /** A bookmark's line (GetPlacesScrollList, 502 to 528). */
  function rowOf(bookmark: Bookmark): { readonly cells: readonly string[]; readonly hint: string } {
    const [hint] = unzipMemo(bookmark.memo);
    const type = isCoordinateBookmark(bookmark) ? word(WORDS.coordinate, "Coordinate") : resolvedName($names.resolved, "typeGroup", bookmark.typeID, "");
    const jumpsTo = jumpsSystemOf(bookmark);
    let jumps = "0";
    if (jumpsTo !== null && systemID !== null) {
      const count = $names.autopilotJumps[`${systemID}:${jumpsTo}`];
      jumps = count === undefined ? "" : count === null ? word(WORDS.unreachable, "No route") : String(count);
    }
    const sol = solSystemOf(bookmark);
    const cells = [
      hint,
      type,
      jumps,
      sol === null ? "-" : resolvedName($names.resolved, "system", sol, "-"),
      sol === null ? "-" : resolvedName($names.resolved, "systemConstellation", sol, "-"),
      sol === null ? "-" : resolvedName($names.resolved, "systemRegion", sol, "-"),
      dateText(bookmark.created),
      bookmark.expiry === null ? "-" : dateText(bookmark.expiry),
      bookmark.creatorID === null ? "" : resolvedName($names.resolved, "owner", bookmark.creatorID, ""),
    ];
    const note = bookmark.note.length > 50 ? `${bookmark.note.slice(0, 50)}...` : bookmark.note;
    return { cells, hint: note === "" ? hint : `${hint}\n- ${note}` };
  }

  const HEADERS = [
    [WORDS.label, "Label"], [WORDS.type, "Type"], [WORDS.jumps, "Jumps"], [WORDS.sol, "SOL"], [WORDS.con, "CON"],
    [WORDS.reg, "REG"], [WORDS.date, "Date"], [WORDS.expiry, "Expiry"], [WORDS.creator, "Creator"],
  ] as const;
</script>

{#snippet places(list: readonly Bookmark[], depth: number)}
  {#if list.length > 0}
    <div class="table-wrap overflow-x-auto" style={`padding-left: ${depth * 1.25}rem`}>
      <table class="guests locations-places">
        <thead>
          <tr>
            {#each HEADERS as [path, own] (path)}
              <th>{word(path, own)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each list as bookmark (bookmark.bookmarkID)}
            {@const row = rowOf(bookmark)}
            <tr title={row.hint}>
              {#each row.cells as cell, at (at)}
                <td class:num={at === 2}>{cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/snippet}

{#snippet groupHead(id: string, line: string, count: number | null, depth: number, hint: string | null)}
  <button
    type="button"
    class="minor locations-group"
    style={`margin-left: ${depth * 1.25}rem`}
    aria-expanded={isOpen(id)}
    title={hint ?? undefined}
    onclick={() => toggle(id)}
  >
    {isOpen(id) ? "▾" : "▸"} {line}{#if count !== null}{" "}<span class="note">[{count}]</span>{/if}
  </button>
{/snippet}

<section class="panel locations">
  <header class="panel-head">
    <h2 class="panel-title">{word(WORDS.title, "Locations")}</h2>
  </header>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if bookmarking !== null}
    <BookmarkWindow {store} {flow} place={bookmarking} onDone={bookmarkDone} />
  {/if}
  <!-- The window's bottom (window.py 104 to 108): Add Location; Create Folder and Create Subfolder are not here yet. -->
  <p class="controls">
    <button type="button" class="minor" disabled={bookmarking !== null} onclick={addLocation}>{word(WORDS.addBookmark, "Save where I am")}</button>
  </p>
  {#if active === null}
    {#if !error}<p class="note">…</p>{/if}
  {:else}
    <div class="locations-list">
      {@render groupHead("localLocations", filled(WORDS.inSystem, "Here in {system}", { system: systemID === null ? "" : resolvedName($names.resolved, "system", systemID, "") }), null, 0, null)}
      {#if isOpen("localLocations")}
        {@render places(local, 1)}
      {/if}
      {#each sections as section (section.isPersonal)}
        {@const sectionID = section.isPersonal ? "personalFolders" : "sharedFolders"}
        {@render groupHead(sectionID, section.isPersonal ? word(WORDS.personal, "My places") : word(WORDS.shared, "Places shared with me"), section.count, 0, null)}
        {#if isOpen(sectionID)}
          {#each section.folders as entry (entry.folder.folderID)}
            {@const folderKey = `folder:${entry.folder.folderID}`}
            {@render groupHead(folderKey, entry.folder.folderName, entry.count, 1, null)}
            {#if isOpen(folderKey)}
              {#each entry.subfolders as sub (sub.subfolder.subfolderID)}
                {@const subKey = `subfolder:${sub.subfolder.subfolderID}`}
                {@render groupHead(subKey, subfolderLine(sub.subfolder), sub.bookmarks.length, 2, null)}
                {#if isOpen(subKey)}
                  {@render places(sub.bookmarks, 3)}
                {/if}
              {/each}
              {@render places(entry.loose, 2)}
            {/if}
          {/each}
          {#if section.inactive.length > 0}
            {@const inactiveKey = `inactive:${section.isPersonal ? "personal" : "shared"}`}
            {@render groupHead(inactiveKey, word(WORDS.inactive, "Folders offline"), null, 1, null)}
            {#if isOpen(inactiveKey)}
              <ul class="locations-inactive" style="padding-left: 2.5rem">
                {#each section.inactive as folder (folder.folderID)}
                  <li title={folder.isPersonal ? word(WORDS.personalFolder, "Yours") : word(WORDS.sharedFolder, "Shared")}>{folder.folderName}</li>
                {/each}
              </ul>
            {/if}
          {/if}
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .locations-list {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  .locations-group {
    text-align: left;
  }
  .locations-places td {
    white-space: nowrap;
  }
</style>
