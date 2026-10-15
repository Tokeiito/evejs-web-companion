<script lang="ts">
  // The Contacts window (the client's People & Places, AddressBookWindow: addressBookWindow.py), its Contacts tab
  // (ContactsForm, neocom/addressBook/contactsForm.py): the pilot's own contacts and blocked owners, as the client's
  // address book keeps them (charMgr.GetContactList; app/flow.ts addressBook).
  //
  // On the left the form's groups (GetStaticLabelsGroups, 240 to 265; LoadLeftSide, 144 to 180): All Contacts, the
  // five standings, the Buddy List, Blocked, and the Labels with "No Label" first and the pilot's own by name
  // (GetLabelsSubContent, 195 to 213), each with how many it holds (GetContactsCount, 372 to 405;
  // GetContactsLabelCount, 363 to 370). On the right the group chosen (GetScrolllist, 416 to 497): its contacts by
  // name, fifty to a page (maxContactsPerPage), with the window's quick filter (QuickFilterEdit: the names holding
  // what is typed) and "Online only" (onlinebuddyonly: those on the buddy list the online status service has
  // online). A buddy's entry says it is online or offline where that service keeps it (userentry.py SetOnline,
  // 320 to 332; fetch=False, 176), and a blocked owner's says so (SetBlocked, 334 to 342). The group last viewed is
  // kept for the pilot (contacts_lastselected), else the first is shown.
  //
  // Each entry has the client's menu of a contact (menusvc.py 590 to 602, as characterCheckers.py offers each): Add
  // Contact, Edit Contact and Remove Contact, Block and Unblock. Adding and editing open the Contact Management window
  // (contactManagementWindow.py: the five standings, and for a character the buddy list's box, the notification's
  // and a message), confirmed as AddContact or EditContact; removing asks the client's question first
  // (RemoveOneFromContacts); blocking refuses the pilot itself and NPCs in the client's words (BlockOwner, 645 to 664).
  //
  // Not here yet: the Notifications group, the Agents and Search tabs, the labels' writes, and editing several at once.
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import {
    CONTACT_GROUP,
    CONTACT_STANDING,
    MAX_CONTACTS_PER_PAGE,
    hasContactLabel,
    inStandingGroup,
    type NamedAddressBook,
  } from "../bridge/contacts.ts";
  import { isNpcOwner } from "../bridge/mail.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const addressBookState = store.addressBook;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  /** The window's words, by their labels (addressBookWindow.py 60, 86; contactsForm.py 136, 144 to 265, 416 to 497). */
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
    labels: "UI/PeopleAndPlaces/Labels",
    noLabel: "UI/PeopleAndPlaces/NoLabel",
    onlineOnly: "UI/PeopleAndPlaces/OnlineOnly",
    online: "UI/Common/Online",
    offline: "UI/Common/Offline",
    standingExcellent: "UI/PeopleAndPlaces/StandingExcellent",
    standingGood: "UI/PeopleAndPlaces/StandingGood",
    standingNeutral: "UI/PeopleAndPlaces/StandingNeutral",
    standingBad: "UI/PeopleAndPlaces/StandingBad",
    standingTerrible: "UI/PeopleAndPlaces/StandingTerrible",
    noContacts: "UI/PeopleAndPlaces/NoContacts",
    noneOnWatchlist: "UI/PeopleAndPlaces/NoneOnWatchlist",
    noneBlocked: "UI/PeopleAndPlaces/NoneBlockedYet",
    noContactsStanding: "UI/PeopleAndPlaces/NoContactsStanding",
    noContactsLabel: "UI/PeopleAndPlaces/NoContactsLabel",
    noOnlineContact: "UI/PeopleAndPlaces/NoOnlineContact",
    nothingFound: "UI/Common/NothingFound",
    name: "UI/Common/Name",
    next: "UI/Common/Next",
    previous: "UI/Common/Previous",
    withLength: "/Carbon/UI/Controls/ScrollEntries/LabelWithLength",
    management: "UI/PeopleAndPlaces/ContactManagement",
    addContact: "UI/PeopleAndPlaces/AddContact",
    editContact: "UI/PeopleAndPlaces/EditContact",
    removeContact: "UI/PeopleAndPlaces/RemoveContact",
    blockContact: "UI/PeopleAndPlaces/BlockContact",
    unblockContact: "UI/PeopleAndPlaces/UnblockContact",
    toWatchlist: "UI/PeopleAndPlaces/AddContactToWatchlist",
    buddyHint: "UI/PeopleAndPlaces/BuddyListHint",
    sendNotification: "UI/PeopleAndPlaces/SendNotificationTo",
    messageTo: "UI/PeopleAndPlaces/MessageTo",
    cannotBlockSelf: "UI/PeopleAndPlaces/CannotBlockSelf",
    cannotBlockAgents: "UI/PeopleAndPlaces/CannotBlockAgents",
    cannotBlockNpcCorps: "UI/PeopleAndPlaces/CannotBlockNPCCorps",
    alreadyBlocked: "UI/PeopleAndPlaces/AlreadyHaveBlocked",
    cancel: "UI/Common/Buttons/Cancel",
    yes: "UI/Common/Buttons/Yes",
    no: "UI/Common/Buttons/No",
  } as const;
  /** The client's dialogs the window says things with. */
  const DIALOGS = ["RemoveOneFromContacts"] as const;

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

  /** STANDING_DESCRIPTION (contactManagementWindow.py 22 to 26): the five standings' words, the highest first. */
  const LEVELS: readonly (readonly [number, string, string])[] = [
    [CONTACT_STANDING.high, WORDS.excellent, "Excellent Standing"],
    [CONTACT_STANDING.good, WORDS.good, "Good Standing"],
    [CONTACT_STANDING.neutral, WORDS.neutral, "Neutral Standing"],
    [CONTACT_STANDING.bad, WORDS.bad, "Bad Standing"],
    [CONTACT_STANDING.horrible, WORDS.terrible, "Terrible Standing"],
  ];

  /** A label's group, by its bit: "No Label" is -1 (GetLabelsSubContent, 205 to 213). */
  const labelGroup = (labelID: bigint): string => `label:${labelID}`;
  const NO_LABEL = labelGroup(-1n);

  let book = $state<NamedAddressBook | null>(null);
  let error = $state("");
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  const lastSelected: unknown = flow.contactsLastSelected();
  let group = $state<number | string>(typeof lastSelected === "number" || typeof lastSelected === "string" ? lastSelected : CONTACT_GROUP.all);
  let startPos = $state(0);
  // svelte-ignore state_referenced_locally
  const keptOnlineOnly: unknown = flow.onlineBuddyOnly();
  let onlineOnly = $state(keptOnlineOnly === true);
  /** What the quick filter holds, and the text it filters by: taken 0.4 s after the typing stops (_SetQuickFilterInput). */
  let filterText = $state("");
  let filtering = $state("");
  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  /** The entry whose menu is open, by its owner. */
  let menuFor = $state<number | null>(null);
  /** The Contact Management window open (ContactManagementWnd), with what it holds. */
  interface Managing {
    readonly contactID: number;
    readonly name: string;
    readonly isContact: boolean;
    readonly isCharacter: boolean;
    level: number;
    inWatchlist: boolean;
    notify: boolean;
    message: string;
  }
  let managing = $state<Managing | null>(null);
  /** A question of the client's waiting on the pilot (its dialog), and what it says. */
  let question = $state<{ readonly title: string; readonly body: string; readonly answer: (yes: boolean) => void } | null>(null);
  /** What the window last said (CustomInfo). */
  let notes = $state<readonly string[]>([]);

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

  /** The labels by name in lower case (GetLabelsSubContent, 197 to 204). */
  const labels = $derived([...(book?.labels ?? [])].sort((left, right) => {
    const a = left.name.toLowerCase();
    const b = right.name.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }));
  const labelOf = (groupID: number | string) => labels.find((label) => labelGroup(label.labelID) === groupID);

  /** LoadData's filter (contactsForm.py 548 to 552; quickFilter.py QuickFilter): an owner whose name holds the text. */
  const matches = (name: string): boolean => filtering === "" || name.toLowerCase().includes(filtering.toLowerCase());
  const contacts = $derived((book?.contacts ?? []).filter((contact) => matches(contact.name)));
  const blocked = $derived((book?.blocked ?? []).filter((owner) => matches(owner.name)));
  const blockedIDs = $derived(new Set((book?.blocked ?? []).map((owner) => owner.ownerID)));
  const watched = $derived(new Set((book?.contacts ?? []).filter((contact) => contact.inWatchlist).map((contact) => contact.contactID)));

  /** onlineStatus.GetOnlineStatus as the entries read it, from what the service keeps: online, offline, or not known. */
  function onlineOf(contactID: number): boolean | undefined {
    return $addressBookState.online?.[contactID];
  }

  /** GetContactsCount (372 to 405) and GetContactsLabelCount (363 to 370): how many a group holds, of what the filter leaves. */
  function countOf(groupID: number | string): number {
    if (groupID === CONTACT_GROUP.blocked) return blocked.length;
    if (groupID === CONTACT_GROUP.all) return contacts.length;
    if (groupID === CONTACT_GROUP.watchlist) return contacts.filter((contact) => contact.inWatchlist).length;
    if (typeof groupID === "string") {
      const labelID = groupID === NO_LABEL ? -1n : labelOf(groupID)?.labelID;
      return labelID === undefined ? 0 : contacts.filter((contact) => hasContactLabel(labelID, contact.labelMask)).length;
    }
    return contacts.filter((contact) => inStandingGroup(groupID, contact.relationshipID)).length;
  }

  interface Row {
    readonly id: number;
    readonly name: string;
    readonly standing: number | null;
    /** Its online state where it is a buddy whose state the service keeps (SetOnline), else none. */
    readonly online: boolean | null;
    readonly blocked: boolean;
  }

  /**
   * GetScrolllist (416 to 497): the group's entries by name (SortListOfTuples on the name in lower case), a page of
   * them, and the hint for none. "Online only" keeps the buddies the service has online (GetContactEntry, 936 to
   * 948). The buddy list holds characters only; the page takes a contact for one where it is no corporation's or
   * alliance's by its id.
   */
  const shown = $derived.by((): { rows: readonly Row[]; total: number; hint: string } => {
    let entries: { readonly id: number; readonly name: string; readonly standing: number | null }[];
    let hint = word(WORDS.noContacts, "You do not have any contacts.");
    if (group === CONTACT_GROUP.blocked) {
      entries = blocked.map((owner) => ({ id: owner.ownerID, name: owner.name, standing: null }));
      hint = word(WORDS.noneBlocked, "No one is blocked.");
    } else if (group === CONTACT_GROUP.watchlist) {
      entries = contacts.filter((contact) => contact.inWatchlist && isCharacterContact(contact.contactID)).map(entryOf);
      hint = word(WORDS.noneOnWatchlist, "No one is on the buddy list yet.");
    } else if (group === CONTACT_GROUP.all) {
      entries = contacts.map(entryOf);
    } else if (typeof group === "string") {
      const label = labelOf(group);
      const labelID = group === NO_LABEL ? -1n : label?.labelID;
      entries = labelID === undefined ? [] : contacts.filter((contact) => hasContactLabel(labelID, contact.labelMask)).map(entryOf);
      hint = filledWord(WORDS.noContactsLabel, "No contacts with the label: {standingText}", { standingText: group === NO_LABEL ? word(WORDS.noLabel, "No Label") : (label?.name ?? "") });
    } else {
      entries = contacts.filter((contact) => inStandingGroup(group as number, contact.relationshipID)).map(entryOf);
      const [label, own] = STANDING_SHORT[group] ?? [WORDS.standingNeutral, "Neutral"];
      hint = filledWord(WORDS.noContactsStanding, "No contacts with standing: {standingText}", { standingText: word(label, own) });
    }
    if (onlineOnly) {
      entries = entries.filter((entry) => watched.has(entry.id) && onlineOf(entry.id) === true);
      hint = word(WORDS.noOnlineContact, "None of your contacts is online.");
    }
    if (filtering !== "") {
      hint = word(WORDS.nothingFound, "Nothing Found");
    }
    const rows = entries.map((entry): Row => ({
      ...entry,
      online: group !== CONTACT_GROUP.blocked && watched.has(entry.id) && isCharacterContact(entry.id) ? (onlineOf(entry.id) ?? null) : null,
      blocked: blockedIDs.has(entry.id),
    }));
    const sorted = rows.map((row, place) => ({ row, place })).sort((left, right) => {
      const a = left.row.name.toLowerCase();
      const b = right.row.name.toLowerCase();
      return a < b ? -1 : a > b ? 1 : left.place - right.place;
    }).map(({ row }) => row);
    return { rows: sorted.slice(startPos, startPos + MAX_CONTACTS_PER_PAGE), total: sorted.length, hint };
  });

  function entryOf(contact: { readonly contactID: number; readonly name: string; readonly relationshipID: number }) {
    return { id: contact.contactID, name: contact.name, standing: contact.relationshipID };
  }

  /** The pilot's own character, which the menus offer nothing of (characterCheckers.py IsMe). */
  const myID = $derived($station.online?.characterID ?? null);
  const contactIDs = $derived(new Set((book?.contacts ?? []).map((contact) => contact.contactID)));

  /**
   * characterCheckers.py: Add Contact where it is none of the pilot's (62 to 69), Edit and Remove Contact where it is
   * one (254 to 263), Block where it is not blocked (104 to 111), Unblock where it is (373 to 378); none for the pilot
   * itself, and none but Unblock for an NPC.
   */
  function offersOf(ownerID: number): { add: boolean; edit: boolean; block: boolean; unblock: boolean } {
    const mine = ownerID === myID;
    const npc = isNpcOwner(ownerID);
    const isContact = contactIDs.has(ownerID);
    const isBlocked = blockedIDs.has(ownerID);
    return {
      add: !mine && !npc && !isContact,
      edit: !mine && !npc && isContact,
      block: !mine && !npc && !isBlocked,
      unblock: !mine && isBlocked,
    };
  }

  /** A write of the window's, its refusal said. */
  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      error = isSessionLost(cause) ? "Your session ended. Pick your character again." : cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  /**
   * AddToAddressBook (addressbookService.py 705 to 816): the Contact Management window for the owner, a contact's
   * standing and buddy list as they are, a new one at Neutral (contactManagementWindow.py 36 to 37), the
   * notification off and no message.
   */
  function manage(ownerID: number, name: string): void {
    menuFor = null;
    notes = [];
    const contact = (book?.contacts ?? []).find((each) => each.contactID === ownerID);
    managing = {
      contactID: ownerID,
      name,
      isContact: contact !== undefined,
      isCharacter: isCharacterContact(ownerID),
      level: contact?.relationshipID ?? CONTACT_STANDING.neutral,
      inWatchlist: contact?.inWatchlist ?? false,
      notify: false,
      message: "",
    };
  }

  /** Confirm (contactManagementWindow.py 146 to 160): AddContact or EditContact, and the contact kept as the address book keeps it. */
  function confirmManagement(): void {
    const held = managing;
    if (held === null) return;
    void run(async () => {
      await flow.addOrEditContact({
        contactID: held.contactID,
        relationshipID: held.level,
        inWatchlist: held.isCharacter ? held.inWatchlist : false,
        sendNotification: held.isCharacter ? held.notify : false,
        message: held.isCharacter ? held.message : "",
        isCharacter: held.isCharacter,
      }, held.isContact);
      if (book !== null) {
        const before = book.contacts.find((each) => each.contactID === held.contactID);
        const contact = { contactID: held.contactID, name: held.name, relationshipID: held.level, inWatchlist: held.isCharacter && held.inWatchlist, labelMask: before?.labelMask ?? 0n };
        book = { ...book, contacts: [...book.contacts.filter((each) => each.contactID !== held.contactID), contact] };
      }
      managing = null;
    });
  }

  /** RemoveFromAddressBook (817 to 869): the client's question, then DeleteContacts, and the contact let go. */
  function removeContact(ownerID: number, name: string): void {
    menuFor = null;
    notes = [];
    question = {
      title: filledWord("dialog:RemoveOneFromContacts/title", "Remove?", {}),
      body: filledWord("dialog:RemoveOneFromContacts/body", "Take {names} off your contacts?", { names: name }),
      answer: (yes) => {
        question = null;
        if (!yes) return;
        void run(async () => {
          await flow.deleteContacts([ownerID]);
          if (book !== null) {
            book = { ...book, contacts: book.contacts.filter((each) => each.contactID !== ownerID) };
          }
        });
      },
    };
  }

  /** BlockOwner (645 to 664): the pilot itself, an agent and an NPC's corporation refused in the client's words; else BlockOwners. */
  function block(ownerID: number, name: string): void {
    menuFor = null;
    notes = [];
    if (ownerID === myID) {
      notes = [word(WORDS.cannotBlockSelf, "You cannot block yourself.")];
      return;
    }
    if (isNpcOwner(ownerID)) {
      notes = [isCharacterContact(ownerID) ? word(WORDS.cannotBlockAgents, "Agents cannot be blocked.") : word(WORDS.cannotBlockNpcCorps, "NPC corporations cannot be blocked.")];
      return;
    }
    if (blockedIDs.has(ownerID)) {
      notes = [filledWord(WORDS.alreadyBlocked, "{userName} is blocked already.", { userName: name })];
      return;
    }
    void run(async () => {
      await flow.blockOwners([ownerID]);
      if (book !== null) {
        book = { ...book, blocked: [...book.blocked, { ownerID, name }] };
      }
    });
  }

  /** UnblockOwner (666 to 677): UnblockOwners with the owner, and it let go of the blocked. */
  function unblock(ownerID: number): void {
    menuFor = null;
    notes = [];
    void run(async () => {
      await flow.unblockOwners([ownerID]);
      if (book !== null) {
        book = { ...book, blocked: book.blocked.filter((each) => each.ownerID !== ownerID) };
      }
    });
  }

  /** idCheckers.IsCharacter as the page can tell it: no corporation's (1000000 to 1999999, 98000000 to 98999999) nor alliance's (99000000 to 99999999). */
  function isCharacterContact(ownerID: number): boolean {
    return !((ownerID >= 1_000_000 && ownerID <= 1_999_999) || (ownerID >= 98_000_000 && ownerID <= 99_999_999));
  }

  /** LoadGroupFromEntry (345 to 354): another group from the first page, and kept as the one last viewed (424). */
  function choose(groupID: number | string): void {
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

  /** CheckBoxChange (523 to 526): "Online only" kept in the user's settings, and the form drawn again. */
  function onlineOnlyChanged(): void {
    flow.keepOnlineBuddyOnly(onlineOnly);
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
    flow.requestWords([...Object.values(WORDS), ...DIALOGS.flatMap((dialog) => [`dialog:${dialog}/title`, `dialog:${dialog}/body`])]);
    void load();
    void flow.primeContactsOnline().catch(() => {});
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
  {#each notes as said, place (place)}
    <p class="error">{said}</p>
  {/each}
  {#if question !== null}
    <!-- The client's question (its dialog): its title, its body, yes and no. -->
    <div class="contacts-confirm" role="alertdialog" aria-label={question.title}>
      <strong>{question.title}</strong>
      <p>{question.body}</p>
      <p class="controls">
        <button type="button" onclick={() => question?.answer(true)}>{word(WORDS.yes, "Yes")}</button>
        <button type="button" class="minor" onclick={() => question?.answer(false)}>{word(WORDS.no, "No")}</button>
      </p>
    </div>
  {/if}
  {#if managing !== null}
    <!-- Contact Management (ContactManagementWnd): the name, the five standings and the one chosen, and for a
         character the buddy list's box, the notification's and the message; Add Contact or Edit Contact, and Cancel. -->
    <section class="contacts-confirm" aria-label={word(WORDS.management, "Contact Management")}>
      <h3>{word(WORDS.management, "Contact Management")}</h3>
      <p><strong>{managing.name}</strong></p>
      <p>{word(LEVELS.find(([level]) => level === managing?.level)?.[1] ?? WORDS.neutral, LEVELS.find(([level]) => level === managing?.level)?.[2] ?? "Neutral Standing")}</p>
      <p class="controls">
        {#each LEVELS as [level, label, own] (level)}
          <button type="button" class="minor" class:active={managing.level === level} aria-pressed={managing.level === level} title={word(label, own)} onclick={() => { if (managing) managing.level = level; }}>
            {level > 0 ? `+${level}` : String(level)}
          </button>
        {/each}
      </p>
      {#if managing.isCharacter}
        <p class="controls">
          <label title={word(WORDS.buddyHint, "")}>
            <input type="checkbox" bind:checked={managing.inWatchlist} />
            {word(WORDS.toWatchlist, "Add contact to buddy list")}
          </label>
        </p>
        <p class="controls">
          <label>
            <input type="checkbox" bind:checked={managing.notify} />
            {filledWord(WORDS.sendNotification, "Send notification to {contactName}", { contactName: managing.name })}
          </label>
        </p>
        <textarea rows="3" maxlength="120" disabled={!managing.notify} placeholder={filledWord(WORDS.messageTo, "Message to {charName}", { charName: managing.name })} bind:value={managing.message}></textarea>
      {/if}
      <p class="controls">
        <button type="button" class="primary" disabled={busy} onclick={confirmManagement}>{managing.isContact ? word(WORDS.editContact, "Edit Contact") : word(WORDS.addContact, "Add Contact")}</button>
        <button type="button" class="minor" onclick={() => (managing = null)}>{word(WORDS.cancel, "Cancel")}</button>
      </p>
    </section>
  {/if}

  <nav class="tabs">
    <button type="button" class="active">{word(WORDS.contacts, "Contacts")}</button>
  </nav>

  <div class="contacts-form">
    <!-- The form's groups, each with how many it holds (ListGroup's LabelWithLength), and the labels under theirs. -->
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
      {#if book !== null && book.labels !== null}
        <li class="contacts-gap" aria-hidden="true"></li>
        <li class="contacts-labels-head">{word(WORDS.labels, "Labels")}</li>
        <li>
          <button type="button" class="minor contacts-label" class:active={group === NO_LABEL} onclick={() => choose(NO_LABEL)}>
            {word(WORDS.noLabel, "No Label")} [{countOf(NO_LABEL)}]
          </button>
        </li>
        {#each labels as label (String(label.labelID))}
          <li>
            <button type="button" class="minor contacts-label" class:active={group === labelGroup(label.labelID)} onclick={() => choose(labelGroup(label.labelID))}>
              {label.name} [{countOf(labelGroup(label.labelID))}]
            </button>
          </li>
        {/each}
      {/if}
    </ul>

    <div class="contacts-list">
      <p class="controls">
        <label>
          <input type="checkbox" bind:checked={onlineOnly} onchange={onlineOnlyChanged} />
          {word(WORDS.onlineOnly, "Online only")}
        </label>
        <input type="search" maxlength="100" aria-label="Filter" bind:value={filterText} oninput={filterTyped} />
      </p>
      {#if book === null}
        <p class="note">{busy ? "Reading…" : ""}</p>
      {:else if shown.rows.length === 0}
        <p class="note">{shown.hint}</p>
      {:else}
        <table>
          <thead>
            <tr><th>{word(WORDS.name, "Name")}</th><th></th><th></th><th></th></tr>
          </thead>
          <tbody>
            {#each shown.rows as row (row.id)}
              <tr>
                <td>{row.name}</td>
                <td class="contacts-state">
                  {#if row.blocked}
                    <span class="badge">{word(WORDS.blocked, "Blocked")}</span>
                  {:else if row.online !== null}
                    <span class="badge" class:accent={row.online}>{row.online ? word(WORDS.online, "Online") : word(WORDS.offline, "Offline")}</span>
                  {/if}
                </td>
                <td class="contacts-standing">{row.standing === null ? "" : row.standing > 0 ? `+${row.standing}` : String(row.standing)}</td>
                <td>
                  <button type="button" class="minor" aria-expanded={menuFor === row.id} aria-label="Menu" onclick={() => (menuFor = menuFor === row.id ? null : row.id)}>⋯</button>
                </td>
              </tr>
              {#if menuFor === row.id}
                {@const offers = offersOf(row.id)}
                <!-- The entry's menu of a contact (menusvc.py 590 to 602). -->
                <tr class="contacts-menu">
                  <td colspan="4">
                    {#if offers.add}
                      <button type="button" class="minor" disabled={busy} onclick={() => manage(row.id, row.name)}>{word(WORDS.addContact, "Add Contact")}</button>
                    {/if}
                    {#if offers.edit}
                      <button type="button" class="minor" disabled={busy} onclick={() => manage(row.id, row.name)}>{word(WORDS.editContact, "Edit Contact")}</button>
                      <button type="button" class="minor" disabled={busy} onclick={() => removeContact(row.id, row.name)}>{word(WORDS.removeContact, "Remove Contact")}</button>
                    {/if}
                    {#if offers.unblock}
                      <button type="button" class="minor" disabled={busy} onclick={() => unblock(row.id)}>{word(WORDS.unblockContact, "Unblock")}</button>
                    {/if}
                    {#if offers.block}
                      <button type="button" class="minor" disabled={busy} onclick={() => block(row.id, row.name)}>{word(WORDS.blockContact, "Block")}</button>
                    {/if}
                  </td>
                </tr>
              {/if}
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
  .contacts-labels-head {
    font-weight: 600;
  }
  .contacts-label {
    padding-left: 1rem;
  }
  .contacts-list {
    flex: 1 1 18rem;
    min-width: 0;
  }
  .contacts-state {
    text-align: center;
  }
  .contacts-standing {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .contacts-pages {
    justify-content: flex-end;
  }
  .contacts-confirm {
    border: 1px solid currentColor;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .contacts-confirm textarea {
    width: 100%;
    font: inherit;
  }
  /* The standing chosen, marked without colour alone. */
  .contacts-confirm button.active {
    text-decoration: underline;
    font-weight: 600;
  }
</style>
