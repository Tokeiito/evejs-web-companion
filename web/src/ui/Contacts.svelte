<script lang="ts">
  // The Contacts window (the client's People & Places, AddressBookWindow: addressBookWindow.py), its Contacts tab
  // (ContactsForm, neocom/addressBook/contactsForm.py): the pilot's own contacts and blocked owners, as the client's
  // address book keeps them (charMgr.GetContactList; app/flow.ts addressBook).
  //
  // On the left the form's groups (GetStaticLabelsGroups, 240 to 265): All Contacts, the five standings, the Buddy
  // List, and Blocked, each with how many it holds (GetContactsCount, 372 to 405). On the right the group chosen
  // (GetScrolllist, 416 to 497): its contacts by name, fifty to a page (maxContactsPerPage), with the window's quick
  // filter (QuickFilterEdit: the names holding what is typed). The group last viewed is kept for the pilot
  // (contacts_lastselected), else the first is shown.
  //
  // Not here yet: the Notifications group, the labels, "Online only", the Agents and Search tabs, and every write.
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import {
    CONTACT_GROUP,
    CONTACT_STANDING,
    MAX_CONTACTS_PER_PAGE,
    inStandingGroup,
    type NamedAddressBook,
  } from "../bridge/contacts.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;

  /** The window's words, by their labels (addressBookWindow.py 60, 86; contactsForm.py 182 to 265, 416 to 497). */
  const WORDS = {
    title: "UI/PeopleAndPlaces/WindowTitle",
    contacts: "UI/PeopleAndPlaces/Contacts",
    all: "UI/PeopleAndPlaces/AllContacts",
    excellent: "UI/PeopleAndPlaces/ExcellentStanding",
    good: "UI/PeopleAndPlaces/GoodStanding",
    neutral: "UI/PeopleAndPlaces/NeutralStanding",
    bad: "UI/PeopleAndPlaces/BadStanding",
    terrible: "UI/PeopleAndPlaces/TerribleStanding",
    watchlist: "UI/PeopleAndPlaces/Watchlist",
    blocked: "UI/PeopleAndPlaces/Blocked",
    standingExcellent: "UI/PeopleAndPlaces/StandingExcellent",
    standingGood: "UI/PeopleAndPlaces/StandingGood",
    standingNeutral: "UI/PeopleAndPlaces/StandingNeutral",
    standingBad: "UI/PeopleAndPlaces/StandingBad",
    standingTerrible: "UI/PeopleAndPlaces/StandingTerrible",
    noContacts: "UI/PeopleAndPlaces/NoContacts",
    noneOnWatchlist: "UI/PeopleAndPlaces/NoneOnWatchlist",
    noneBlocked: "UI/PeopleAndPlaces/NoneBlockedYet",
    noContactsStanding: "UI/PeopleAndPlaces/NoContactsStanding",
    nothingFound: "UI/Common/NothingFound",
    name: "UI/Common/Name",
    next: "UI/Common/Next",
    previous: "UI/Common/Previous",
    withLength: "/Carbon/UI/Controls/ScrollEntries/LabelWithLength",
  } as const;

  /** The client's word for a label, from the player's install; the page's own where there is none to read. */
  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? template : own;
  }

  function filledWord(label: string, own: string, args: Record<string, string>): string {
    return plainText(formatTemplate(word(label, own), args, { nameOf: () => "" }));
  }

  /** The groups of the Contacts tab, in the form's order, each with its word (GetStaticLabelsGroups). */
  const GROUPS: readonly (readonly [number, string, string])[] = [
    [CONTACT_GROUP.all, WORDS.all, "All Contacts"],
    [CONTACT_STANDING.high, WORDS.excellent, "Excellent Standing"],
    [CONTACT_STANDING.good, WORDS.good, "Good Standing"],
    [CONTACT_STANDING.neutral, WORDS.neutral, "Neutral Standing"],
    [CONTACT_STANDING.bad, WORDS.bad, "Bad Standing"],
    [CONTACT_STANDING.horrible, WORDS.terrible, "Terrible Standing"],
    [CONTACT_GROUP.watchlist, WORDS.watchlist, "Buddy List"],
    [CONTACT_GROUP.blocked, WORDS.blocked, "Blocked"],
  ];

  /** GetStandingNameShort (182 to 193): a standing group's word, for the hint of an empty one. */
  const STANDING_SHORT: Readonly<Record<number, readonly [string, string]>> = {
    [CONTACT_STANDING.high]: [WORDS.standingExcellent, "Excellent"],
    [CONTACT_STANDING.good]: [WORDS.standingGood, "Good"],
    [CONTACT_STANDING.neutral]: [WORDS.standingNeutral, "Neutral"],
    [CONTACT_STANDING.bad]: [WORDS.standingBad, "Bad"],
    [CONTACT_STANDING.horrible]: [WORDS.standingTerrible, "Terrible"],
  };

  let book = $state<NamedAddressBook | null>(null);
  let error = $state("");
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  const lastSelected: unknown = flow.contactsLastSelected();
  let group = $state<number>(typeof lastSelected === "number" ? lastSelected : CONTACT_GROUP.all);
  let startPos = $state(0);
  /** What the quick filter holds, and the text it filters by: taken 0.4 s after the typing stops (_SetQuickFilterInput). */
  let filterText = $state("");
  let filtering = $state("");
  let filterTimer: ReturnType<typeof setTimeout> | null = null;

  async function load(): Promise<void> {
    busy = true;
    error = "";
    try {
      book = await flow.addressBook();
    } catch (cause) {
      error = isSessionLost(cause) ? "Your session ended. Pick your character again." : cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  /** LoadData's filter (contactsForm.py 548 to 552; quickFilter.py QuickFilter): an owner whose name holds the text. */
  const matches = (name: string): boolean => filtering === "" || name.toLowerCase().includes(filtering.toLowerCase());
  const contacts = $derived((book?.contacts ?? []).filter((contact) => matches(contact.name)));
  const blocked = $derived((book?.blocked ?? []).filter((owner) => matches(owner.name)));

  /** GetContactsCount (372 to 405): how many a group holds, of what the filter leaves. */
  function countOf(groupID: number): number {
    if (groupID === CONTACT_GROUP.blocked) return blocked.length;
    if (groupID === CONTACT_GROUP.all) return contacts.length;
    if (groupID === CONTACT_GROUP.watchlist) return contacts.filter((contact) => contact.inWatchlist).length;
    return contacts.filter((contact) => inStandingGroup(groupID, contact.relationshipID)).length;
  }

  interface Row {
    readonly id: number;
    readonly name: string;
    readonly standing: number | null;
  }

  /**
   * GetScrolllist (416 to 497): the group's entries by name (SortListOfTuples on the name in lower case), a page of
   * them, and the hint for none. The buddy list holds characters only; the page takes a contact for one where it is
   * no corporation's or alliance's by its id.
   */
  const shown = $derived.by((): { rows: readonly Row[]; total: number; hint: string } => {
    let rows: Row[];
    let hint = word(WORDS.noContacts, "You do not have any contacts.");
    if (group === CONTACT_GROUP.blocked) {
      rows = blocked.map((owner) => ({ id: owner.ownerID, name: owner.name, standing: null }));
      hint = word(WORDS.noneBlocked, "No one is blocked.");
    } else if (group === CONTACT_GROUP.watchlist) {
      rows = contacts.filter((contact) => contact.inWatchlist && isCharacterContact(contact.contactID)).map(rowOf);
      hint = word(WORDS.noneOnWatchlist, "No one is on the buddy list yet.");
    } else if (group === CONTACT_GROUP.all) {
      rows = contacts.map(rowOf);
    } else {
      rows = contacts.filter((contact) => inStandingGroup(group, contact.relationshipID)).map(rowOf);
      const [label, own] = STANDING_SHORT[group] ?? [WORDS.standingNeutral, "Neutral"];
      hint = filledWord(WORDS.noContactsStanding, "No contacts with standing: {standingText}", { standingText: word(label, own) });
    }
    if (filtering !== "") {
      hint = word(WORDS.nothingFound, "Nothing Found");
    }
    const sorted = rows.map((row, place) => ({ row, place })).sort((left, right) => {
      const a = left.row.name.toLowerCase();
      const b = right.row.name.toLowerCase();
      return a < b ? -1 : a > b ? 1 : left.place - right.place;
    }).map(({ row }) => row);
    return { rows: sorted.slice(startPos, startPos + MAX_CONTACTS_PER_PAGE), total: sorted.length, hint };
  });

  function rowOf(contact: { readonly contactID: number; readonly name: string; readonly relationshipID: number }): Row {
    return { id: contact.contactID, name: contact.name, standing: contact.relationshipID };
  }

  /** idCheckers.IsCharacter as the page can tell it: no corporation's (1000000 to 1999999, 98000000 to 98999999) nor alliance's (99000000 to 99999999). */
  function isCharacterContact(ownerID: number): boolean {
    return !((ownerID >= 1_000_000 && ownerID <= 1_999_999) || (ownerID >= 98_000_000 && ownerID <= 99_999_999));
  }

  /** LoadGroupFromEntry (345 to 354): another group from the first page, and kept as the one last viewed (424). */
  function choose(groupID: number): void {
    if (group !== groupID) {
      startPos = 0;
      group = groupID;
    }
    flow.keepContactsLastSelected(groupID);
  }

  /** BrowseContacts (554 to 558): a page back or on. */
  function browse(step: number): void {
    startPos = Math.max(0, startPos + MAX_CONTACTS_PER_PAGE * step);
  }

  function filterTyped(): void {
    if (filterTimer !== null) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      filterTimer = null;
      if (filtering !== filterText) {
        filtering = filterText;
      }
    }, 400);
  }

  onMount(() => {
    flow.requestWords(Object.values(WORDS));
    void load();
    return () => {
      if (filterTimer !== null) clearTimeout(filterTimer);
    };
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">{word(WORDS.title, "Contacts")}</h2>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <nav class="tabs">
    <button type="button" class="active">{word(WORDS.contacts, "Contacts")}</button>
  </nav>

  <div class="contacts-form">
    <!-- The form's groups, each with how many it holds (ListGroup's LabelWithLength). -->
    <ul class="contacts-groups">
      {#each GROUPS as [groupID, label, own] (groupID)}
        {#if groupID === CONTACT_GROUP.blocked}
          <li class="contacts-gap" aria-hidden="true"></li>
        {/if}
        <li>
          <button type="button" class="minor" class:active={group === groupID} onclick={() => choose(groupID)}>
            {filledWord(WORDS.withLength, "{label} [{length}]", { label: word(label, own), length: String(countOf(groupID)) })}
          </button>
        </li>
      {/each}
    </ul>

    <div class="contacts-list">
      <p class="controls">
        <input type="search" maxlength="100" aria-label="Filter" bind:value={filterText} oninput={filterTyped} />
      </p>
      {#if book === null}
        <p class="note">{busy ? "Reading…" : ""}</p>
      {:else if shown.rows.length === 0}
        <p class="note">{shown.hint}</p>
      {:else}
        <table>
          <thead>
            <tr><th>{word(WORDS.name, "Name")}</th><th></th></tr>
          </thead>
          <tbody>
            {#each shown.rows as row (row.id)}
              <tr>
                <td>{row.name}</td>
                <td class="contacts-standing">{row.standing === null ? "" : row.standing > 0 ? `+${row.standing}` : String(row.standing)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if startPos > 0 || startPos + MAX_CONTACTS_PER_PAGE < shown.total}
        <!-- The form's pages (UpdatePaginationCont, 563 to 584): back and on, and which of how many. -->
        <p class="controls contacts-pages">
          <span>{Math.floor(startPos / MAX_CONTACTS_PER_PAGE) + 1}/{Math.ceil(shown.total / MAX_CONTACTS_PER_PAGE)}</span>
          <button type="button" class="minor" disabled={startPos === 0} aria-label={word(WORDS.previous, "Previous")} onclick={() => browse(-1)}>‹</button>
          <button type="button" class="minor" disabled={startPos + MAX_CONTACTS_PER_PAGE >= shown.total} aria-label={word(WORDS.next, "Next")} onclick={() => browse(1)}>›</button>
        </p>
      {/if}
    </div>
  </div>
</section>

<style>
  .contacts-form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .contacts-groups {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 0 1 14rem;
  }
  .contacts-groups button {
    display: block;
    width: 100%;
    text-align: left;
  }
  /* The group shown, marked without colour alone. */
  .contacts-groups button.active {
    text-decoration: underline;
    font-weight: 600;
  }
  .contacts-gap {
    height: 0.75rem;
  }
  .contacts-list {
    flex: 1 1 18rem;
    min-width: 0;
  }
  .contacts-standing {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .contacts-pages {
    justify-content: flex-end;
  }
</style>
